// 简单的内存缓存实现
class MemoryCache {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 默认5分钟
  }

  // 生成缓存键
  generateKey(prefix, params) {
    const paramStr = params ? JSON.stringify(params) : '';
    return `${prefix}:${paramStr}`;
  }

  // 获取缓存
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    // 检查是否过期
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  // 设置缓存
  set(key, value, ttl = this.defaultTTL) {
    const expiresAt = Date.now() + ttl;
    this.cache.set(key, { value, expiresAt });
  }

  // 删除缓存
  delete(key) {
    this.cache.delete(key);
  }

  // 清空缓存
  clear() {
    this.cache.clear();
  }

  // 清理过期缓存
  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  // 按前缀清理缓存
  clearPrefix(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

// 创建全局缓存实例
const cache = new MemoryCache();

// 定期清理过期缓存（每10分钟）
setInterval(() => {
  cache.cleanup();
}, 10 * 60 * 1000);

module.exports = cache;
