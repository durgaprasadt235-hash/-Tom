// Relational Database Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'postgresql',
    name: 'PostgreSQL',
    vendor: 'PostgreSQL Global Development Group',
    category: 'databases',
    description: 'Advanced open-source relational database',
    icon: '🐘',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute read queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['password', 'certificate'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'mysql',
    name: 'MySQL',
    vendor: 'Oracle',
    category: 'databases',
    description: 'Popular open-source relational database',
    icon: '🐬',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute read queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['password'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'sql-server',
    name: 'SQL Server',
    vendor: 'Microsoft',
    category: 'databases',
    description: 'Enterprise relational database management system',
    icon: ' SQL',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute read queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['password', 'windows', 'certificate'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'oracle-database',
    name: 'Oracle Database',
    vendor: 'Oracle',
    category: 'databases',
    description: 'Enterprise-grade relational database',
    icon: ' Oracle',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute read queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['password', 'certificate'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    vendor: 'SQLite Consortium',
    category: 'databases',
    description: 'Self-contained embedded relational database',
    icon: '🗄',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table schema', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute read queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['none'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];