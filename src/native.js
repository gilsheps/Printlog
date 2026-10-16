// When running inside the desktop app, folders are accessed through the app (Node)
// instead of the browser's File System Access API. These classes mimic the small
// part of FileSystemDirectoryHandle / FileSystemFileHandle that the library uses.

export const native = typeof window !== 'undefined' ? window.shelfNative || null : null;

class NativeFileLike {
  constructor(rel, name, size, mtime) {
    this._rel = rel;
    this.name = name;
    this.size = size;
    this.lastModified = mtime;
    this.type = '';
  }
  async arrayBuffer() { return native.fs.read(this._rel); }
  async text() { return new TextDecoder().decode(await this.arrayBuffer()); }
  async blob(type = '') { return new Blob([await this.arrayBuffer()], { type }); }
}

class NativeFileHandle {
  constructor(rel, name) { this.kind = 'file'; this._rel = rel; this.name = name; }
  async getFile() {
    const st = await native.fs.stat(this._rel);
    if (!st) throw new DOMException('not found', 'NotFoundError');
    return new NativeFileLike(this._rel, this.name, st.size, st.mtime);
  }
  async createWritable() {
    const parts = [];
    const rel = this._rel;
    return {
      async write(data) {
        if (typeof data === 'string') parts.push(new TextEncoder().encode(data));
        else if (data instanceof ArrayBuffer) parts.push(new Uint8Array(data));
        else if (ArrayBuffer.isView(data)) parts.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        else if (data && typeof data.arrayBuffer === 'function') parts.push(new Uint8Array(await data.arrayBuffer()));
        else throw new TypeError('unsupported data');
      },
      async close() {
        const len = parts.reduce((a, p) => a + p.length, 0);
        const all = new Uint8Array(len);
        let o = 0;
        for (const p of parts) { all.set(p, o); o += p.length; }
        await native.fs.write(rel, all);
      },
    };
  }
}

export class NativeDirHandle {
  constructor(rel, name) { this.kind = 'directory'; this._rel = rel; this.name = name; }
  _join(n) { return this._rel ? this._rel + '/' + n : n; }
  async *entries() {
    const list = await native.fs.list(this._rel);
    for (const e of list) {
      const rel = this._join(e.name);
      yield [e.name, e.dir ? new NativeDirHandle(rel, e.name) : new NativeFileHandle(rel, e.name)];
    }
  }
  async getDirectoryHandle(name, opts = {}) {
    const rel = this._join(name);
    const st = await native.fs.stat(rel);
    if (!st) {
      if (!opts.create) throw new DOMException('not found', 'NotFoundError');
      await native.fs.mkdir(rel);
    } else if (!st.dir) throw new DOMException('not a directory', 'TypeMismatchError');
    return new NativeDirHandle(rel, name);
  }
  async getFileHandle(name, opts = {}) {
    const rel = this._join(name);
    const st = await native.fs.stat(rel);
    if (!st) {
      if (!opts.create) throw new DOMException('not found', 'NotFoundError');
      await native.fs.write(rel, new Uint8Array(0));
    } else if (st.dir) throw new DOMException('is a directory', 'TypeMismatchError');
    return new NativeFileHandle(rel, name);
  }
  async removeEntry(name) { await native.fs.remove(this._join(name)); }
  async requestPermission() { return 'granted'; }
  async queryPermission() { return 'granted'; }
}

// Blob from either a real File or a native file-like
export async function toBlob(f, type = '') {
  if (f instanceof Blob) return f;
  return new Blob([await f.arrayBuffer()], { type });
}
