// Managed Database Services Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'neon',
    name: 'Neon',
    vendor: 'Neon Technology',
    category: 'databases',
    description: 'Serverless PostgreSQL with branching',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'branch.read', description: 'Read branch information', riskLevel: 'read', executable: false },
      { name: 'connection.read', description: 'Read connection details', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'supabase',
    name: 'Supabase',
    vendor: 'Supabase',
    category: 'databases',
    description: 'Open source Firebase alternative with PostgreSQL',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table schema', riskLevel: 'read', executable: false },
      { name: 'auth.user.read', description: 'Read user information', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'planetscale',
    name: 'PlanetScale',
    vendor: 'PlanetScale',
    category: 'databases',
    description: 'Serverless MySQL platform with branching',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'branch.read', description: 'Read branch information', riskLevel: 'read', executable: false },
      { name: 'connection.read', description: 'Read connection details', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'amazon-rds',
    name: 'Amazon RDS',
    vendor: 'Amazon',
    category: 'databases',
    description: 'Managed relational database service',
    icon: ' RDS',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'instance.read', description: 'Read instance information', riskLevel: 'read', executable: false },
      { name: 'parameter.read', description: 'Read parameter group settings', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['iam', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'amazon-aurora',
    name: 'Amazon Aurora',
    vendor: 'Amazon',
    category: 'databases',
    description: 'MySQL/PostgreSQL-compatible managed database',
    icon: ' Aurora',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'cluster.read', description: 'Read cluster information', riskLevel: 'read', executable: false },
      { name: 'instance.read', description: 'Read instance information', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['iam', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'azure-sql',
    name: 'Azure SQL',
    vendor: 'Microsoft',
    category: 'databases',
    description: 'Managed SQL Server in Azure',
    icon: ' SQL',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'server.read', description: 'Read server information', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'google-cloud-sql',
    name: 'Google Cloud SQL',
    vendor: 'Google',
    category: 'databases',
    description: 'Managed relational database service',
    icon: ' Cloud SQL',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'database.read', description: 'Read database metadata', riskLevel: 'read', executable: false },
      { name: 'instance.read', description: 'Read instance information', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];