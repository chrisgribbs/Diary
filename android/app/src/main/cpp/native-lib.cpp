// Starts Node.js inside the WellWrite app and passes messages between it and Java.
// Adapted from nodejs-mobile-react-native 18.20.4 (MIT licence, Janea Systems and contributors; see LICENSE-nodejs-mobile).
#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>

#include "node.h"
#include "rn-bridge.h"

static JNIEnv* nodeEnv = nullptr;   // the thread running Node calls back into Java with this
static jclass bridgeClass = nullptr;
static jmethodID fromNode = nullptr;

extern "C" JNIEXPORT void JNICALL
Java_com_chrisgribble_wellwrite_NodeBridge_sendToNode(JNIEnv* env, jclass, jstring channel, jstring msg) {
  const char* c = env->GetStringUTFChars(channel, 0);
  const char* m = env->GetStringUTFChars(msg, 0);
  rn_bridge_notify(c, m);
  env->ReleaseStringUTFChars(channel, c);
  env->ReleaseStringUTFChars(msg, m);
}

static void receive(const char* channel, const char* msg) {
  JNIEnv* env = nodeEnv;
  if (!env || !bridgeClass || !fromNode) return;
  jstring c = env->NewStringUTF(channel);
  jstring m = env->NewStringUTF(msg);
  env->CallStaticVoidMethod(bridgeClass, fromNode, c, m);
  env->DeleteLocalRef(c);
  env->DeleteLocalRef(m);
}

// Node's output goes to logcat (tag NODEJS).
static int outPipe[2], errPipe[2];
static void* pump(void* arg) {
  int fd = *(int*)arg; int prio = fd == errPipe[0] ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO;
  char buf[2048]; ssize_t n;
  while ((n = read(fd, buf, sizeof buf - 1)) > 0) {
    if (buf[n - 1] == '\n') --n;
    buf[n] = 0;
    __android_log_write(prio, "NODEJS", buf);
  }
  return nullptr;
}
static void redirectOutput() {
  pthread_t t1, t2;
  setvbuf(stdout, 0, _IONBF, 0); pipe(outPipe); dup2(outPipe[1], STDOUT_FILENO);
  setvbuf(stderr, 0, _IONBF, 0); pipe(errPipe); dup2(errPipe[1], STDERR_FILENO);
  pthread_create(&t1, 0, pump, &outPipe[0]); pthread_detach(t1);
  pthread_create(&t2, 0, pump, &errPipe[0]); pthread_detach(t2);
}

// Runs Node until it exits (it doesn't, while the app is alive). Node needs its arguments in one block of memory.
extern "C" JNIEXPORT jint JNICALL
Java_com_chrisgribble_wellwrite_NodeBridge_startNode(JNIEnv* env, jclass cls, jobjectArray arguments) {
  jsize argc = env->GetArrayLength(arguments);
  size_t size = 0;
  for (jsize i = 0; i < argc; i++) {
    jstring s = (jstring)env->GetObjectArrayElement(arguments, i);
    size += env->GetStringUTFLength(s) + 1;
    env->DeleteLocalRef(s);
  }
  char* block = (char*)calloc(size, 1);
  char** argv = (char**)calloc(argc + 1, sizeof(char*));
  char* pos = block;
  for (jsize i = 0; i < argc; i++) {
    jstring s = (jstring)env->GetObjectArrayElement(arguments, i);
    const char* a = env->GetStringUTFChars(s, 0);
    size_t len = strlen(a);
    memcpy(pos, a, len); pos[len] = 0;
    argv[i] = pos; pos += len + 1;
    env->ReleaseStringUTFChars(s, a);
    env->DeleteLocalRef(s);
  }
  nodeEnv = env;
  bridgeClass = (jclass)env->NewGlobalRef(cls);
  fromNode = env->GetStaticMethodID(cls, "fromNode", "(Ljava/lang/String;Ljava/lang/String;)V");
  rn_register_bridge_cb(&receive);
  redirectOutput();
  return jint(node::Start(argc, argv));
}
