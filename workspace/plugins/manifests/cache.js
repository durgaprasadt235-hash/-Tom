// Cache Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'redis',
    name: 'Redis',
    vendor: 'Redis Ltd.',
    category: 'databases',
    description: 'In-memory data structure store for caching and messaging',
    icon: ' Redis',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'key.read', description: 'Read key metadata', riskLevel: 'read', executable: false },
      { name: 'key.list', description: 'List keys', riskLevel: 'read', executable: false },
      { name: 'command.execute', description: 'Execute Redis commands', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['password'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'memcached',
    name: 'Memcached',
    vendor: 'Memcached',
    category: 'databases',
    description: 'High-performance distributed memory cache',
    icon: ' Memcached',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'stats.read', description: 'Read statistics', riskLevel: 'read', executable: false },
      { name: 'key.read', description: 'Read cached values', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['none'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];