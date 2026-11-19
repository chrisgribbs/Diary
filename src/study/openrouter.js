'use strict';
/**
 * OpenRouter: one key, many AI models (https://openrouter.ai). Bible study uses it for writing and for embeddings.
 *
 *  - Your key is kept on this device only, protected like a personal API.Bible key (DPAPI on Windows, the
 *    Android Keystore on a phone). It is never in WellWrite's code or builds.
 *  - Requests ask OpenRouter to use only hosts that don't keep or train on what's sent (data_collection: deny),
 *    unless you turn that off in Settings.
 *  - What each request cost is added up per month on this device, so Settings can show it.
 */
const fs = require('fs');

const BASE = 'https://openrouter.ai/api/v1';
// OpenRouter's alias for the newest DeepSeek Flash (V4.1 in November 2026), so a retired snapshot doesn't break studies.
const DEFAULT_MODEL = '~deepseek/deepseek-flash-latest';
const DEFAULT_EMBED = 'perplexity/pplx-embed-v1-0.6b';
// Offered in Settings; any other OpenRouter model name can be typed in.
const MODELS = [
  { id: '~deepseek/deepseek-flash-latest', name: 'DeepSeek Flash (newest)', note: 'Open model. About 1–2¢ a study.' },
  { id: 'z-ai/glm-5.2', name: 'GLM 5.2', note: 'Open model. A few cents a study.' },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', note: 'Strongest writing. About 10¢ a study.' },
];
const MODEL_RE = /^~?[a-z0-9][\w.-]*\/[\w.:~-]{1,80}$/i;

class OpenRouterError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** A plain message for what went wrong. */
function explain(status, body) {
  const said = (body && body.error && (body.error.message || body.error)) || '';
  if (status === 401) return new OpenRouterError('OpenRouter didn’t accept your key. Check it was copied whole (it starts “sk-or-v1-”) and hasn’t been deleted at openrouter.ai.', 'key');
  if (status === 402) return new OpenRouterError('Your OpenRouter account is out of credit. Add some at openrouter.ai, then try again.', 'credit');
  if (status === 429) return new OpenRouterError('OpenRouter is busy or you’ve reached a limit. Wait a minute and try again.', 'rate');
  if (status === 404 && /data policy|endpoints found/i.test(String(said))) return new OpenRouterError('No host for this model meets the privacy setting (don’t keep data). Choose another model, or change the setting in Settings → Bible study.', 'privacy');
  if (status === 400 && /model/i.test(String(said))) return new OpenRouterError(`OpenRouter doesn’t know that model (${String(said).slice(0, 120)}). Choose another in Settings → Bible study.`, 'model');
  return new OpenRouterError(`OpenRouter couldn’t answer (${status}${said ? ': ' + String(said).slice(0, 160) : ''}).`, 'http');
}

class OpenRouter {
  /**
   * file, protect, unprotect, available: where and how the key is kept (see backend.js secretStore)
   * fetch: (url, opts) → Response; usageFile: where this month's spending is counted; base: (tests) another server
   */
  constructor({ file, protect, unprotect, available = () => true, fetch, usageFile, base = BASE, appVersion = '' }) {
    Object.assign(this, { file, protect, unprotect, available, fetchImpl: fetch, usageFile, base: base.replace(/\/+$/, ''), appVersion });
  }

  _read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  _write(d) { fs.mkdirSync(require('path').dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(d)); }
  _key() {
    if (this.mem) return this.mem;   // a synced key on a device that can't protect one: kept in memory only
    const d = this._read(); if (!d.key) return ''; try { return this.unprotect(d.key) || ''; } catch { return ''; }
  }
  /** Keep a key that's already been checked (one that came by sync), without asking OpenRouter again. */
  storeKey(key) {
    this.mem = '';
    if (this.available()) { const d = this._read(); d.key = this.protect(key); this._write(d); } else this.mem = key;
  }
  hasKey() { return !!this._key(); }

  async setKey(key) {
    key = String(key || '').trim();
    if (!/^sk-or-[\w-]{10,200}$/.test(key)) throw new OpenRouterError('That doesn’t look like an OpenRouter key (they start “sk-or-”).', 'key');
    if (!this.available()) throw new OpenRouterError('This device can’t keep a key safely, so it can’t be saved here.', 'store');
    const info = await this._keyInfo(key);   // checks it works before keeping it
    this.mem = '';
    const d = this._read(); d.key = this.protect(key); this._write(d);
    return info;
  }
  forget() { this.mem = ''; try { fs.unlinkSync(this.file); } catch {} return true; }

  _headers(key) {
    return {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/chrisgribbs/Diary',
      'X-Title': 'WellWrite',
    };
  }

  async _keyInfo(key) {
    let res;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.keyTimeout || 20000);   // never leave Save waiting forever
    try { res = await this.fetchImpl(this.base + '/key', { headers: this._headers(key), signal: ctrl.signal }); }
    catch (e) {
      throw new OpenRouterError(ctrl.signal.aborted ? 'OpenRouter didn’t answer within 20 seconds. Check your connection and try again.'
        : `Couldn’t reach OpenRouter (${(e && (e.message || e.code)) || 'no connection'}). Check your connection.`, 'offline');
    } finally { clearTimeout(timer); }
    let body = null; try { body = await res.json(); } catch {}
    if (!res.ok) throw explain(res.status, body);
    const d = (body && body.data) || {};
    return { label: d.label || '', limit: d.limit == null ? null : +d.limit, usage: +d.usage || 0, free: !!d.is_free_tier };
  }
  /** What OpenRouter says about your key (credit limit, usage). */
  async status() {
    const key = this._key();
    if (!key) return { connected: false, month: this.month() };
    try { return { connected: true, ...(await this._keyInfo(key)), month: this.month() }; }
    catch (e) { return { connected: true, error: e.message, code: e.code, month: this.month() }; }
  }

  // ---- spending, counted on this device: { "2026-11": { usd, requests } }
  _usage() { try { return JSON.parse(fs.readFileSync(this.usageFile, 'utf8')); } catch { return {}; } }
  month(d = new Date()) { const k = d.toISOString().slice(0, 7); const u = this._usage()[k] || {}; return { month: k, usd: +(u.usd || 0), requests: u.requests || 0 }; }
  _count(cost) {
    if (!this.usageFile) return;
    const u = this._usage(), k = new Date().toISOString().slice(0, 7);
    u[k] = { usd: +((u[k] && u[k].usd) || 0) + (+cost || 0), requests: ((u[k] && u[k].requests) || 0) + 1 };
    for (const old of Object.keys(u).sort().slice(0, -13)) delete u[old];
    try { fs.writeFileSync(this.usageFile, JSON.stringify(u)); } catch {}
  }

  _need() {
    const key = this._key();
    if (!key) throw new OpenRouterError('Add your OpenRouter key in Settings → Bible study to write studies.', 'nokey');
    return key;
  }

  /**
   * One chat request. Streams when onDelta is given (each new piece of text as it arrives).
   * Returns { text, model, usage: { prompt, completion, cost }, cut }.
   * cut is true when the answer stopped early: the word limit ran out (finish_reason
   * "length") or the stream ended without OpenRouter's closing "[DONE]".
   * Thinking models (DeepSeek Flash, for one) spend part of max_tokens thinking before
   * they write, so we ask for light thinking and leave the rest for the answer.
   */
  async chat({ model, messages, maxTokens = 3000, temperature = 0.7, onDelta, signal, privateHosts = true, reasoning = 'low' }) {
    const key = this._need();
    if (!MODEL_RE.test(model || '')) model = DEFAULT_MODEL;
    const body = {
      model, messages, max_tokens: maxTokens, temperature, stream: !!onDelta,
      usage: { include: true },
      ...(reasoning ? { reasoning: { effort: reasoning, exclude: true } } : {}),
      ...(privateHosts ? { provider: { data_collection: 'deny' } } : {}),
    };
    let res;
    try { res = await this.fetchImpl(this.base + '/chat/completions', { method: 'POST', headers: this._headers(key), body: JSON.stringify(body), signal }); }
    catch (e) {
      if (e && e.name === 'AbortError') throw new OpenRouterError('Stopped.', 'aborted');
      throw new OpenRouterError('Couldn’t reach OpenRouter. Check your connection.', 'offline');
    }
    if (!res.ok) { let b = null; try { b = await res.json(); } catch {} throw explain(res.status, b); }
    if (!onDelta) {
      const j = await res.json();
      if (j.error) throw explain(j.error.code || 500, j);
      const c0 = (j.choices && j.choices[0]) || {};
      const text = (c0.message && c0.message.content) || '';
      const usage = OpenRouter.usageOf(j.usage);
      this._count(usage.cost);
      return { text, model: j.model || model, usage, cut: c0.finish_reason === 'length' };
    }
    // Server-sent events: lines "data: {...}", comments ": OPENROUTER PROCESSING", and "data: [DONE]".
    let text = '', usage = { prompt: 0, completion: 0, cost: 0 }, got = model, buf = '', finish = null, done = false;
    const handleLine = line => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { done = true; return; }
      if (!data) return;
      let j; try { j = JSON.parse(data); } catch { return; }
      if (j.error) throw explain(j.error.code || 500, j);
      if (j.model) got = j.model;
      const piece = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
      if (piece) { text += piece; onDelta(piece, text); }
      const fr = j.choices && j.choices[0] && j.choices[0].finish_reason;
      if (fr) finish = fr;
      if (j.usage) usage = OpenRouter.usageOf(j.usage);
    };
    const decoder = new TextDecoder();
    try {
      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); handleLine(line); }
        }
      } else {
        buf = await res.text();
      }
      for (const line of buf.split('\n')) handleLine(line.replace(/\r$/, ''));
    } catch (e) {
      if (e instanceof OpenRouterError) throw e;
      if (e && e.name === 'AbortError') throw new OpenRouterError('Stopped.', 'aborted');
      throw new OpenRouterError('The connection to OpenRouter was lost part-way. Try again.', 'offline');
    }
    this._count(usage.cost);
    return { text, model: got, usage, cut: finish === 'length' || (!done && !finish) };
  }

  /** Embeddings for one or more texts: arrays of numbers, in order. */
  async embed(texts, { model = DEFAULT_EMBED, dimensions } = {}) {
    const key = this._need();
    const input = (Array.isArray(texts) ? texts : [texts]).map(t => String(t).slice(0, 8000));
    let res;
    try { res = await this.fetchImpl(this.base + '/embeddings', { method: 'POST', headers: this._headers(key), body: JSON.stringify({ model, input, ...(dimensions ? { dimensions } : {}) }) }); }
    catch { throw new OpenRouterError('Couldn’t reach OpenRouter. Check your connection.', 'offline'); }
    let body = null; try { body = await res.json(); } catch {}
    if (!res.ok || !body || !Array.isArray(body.data)) throw explain(res.status || 500, body);
    if (body.usage) this._count(OpenRouter.usageOf(body.usage).cost);
    return body.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
  }

  static usageOf(u) {
    u = u || {};
    return { prompt: +u.prompt_tokens || 0, completion: +u.completion_tokens || 0, cost: +u.cost || 0 };
  }
}

module.exports = { OpenRouter, OpenRouterError, MODELS, DEFAULT_MODEL, DEFAULT_EMBED, MODEL_RE, BASE };
