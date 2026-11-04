# Node.js (prebuilt libnode from nodejs-mobile, fetched by android/scripts/prepare.js) and the small bridge to it.
cmake_minimum_required(VERSION 3.10)
project(wellwrite)

add_library(wellwrite-node SHARED src/main/cpp/native-lib.cpp src/main/cpp/rn-bridge.cpp)
include_directories(libnode/include/node/ src/main/cpp/)
add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION ${CMAKE_SOURCE_DIR}/libnode/bin/${ANDROID_ABI}/libnode.so)
find_library(log-lib log)
target_link_libraries(wellwrite-node libnode ${log-lib})
