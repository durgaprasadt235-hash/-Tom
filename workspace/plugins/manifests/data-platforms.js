// Data / Lakehouse Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'databricks',
    name: 'Databricks',
    vendor: 'Databricks',
    category: 'data-platforms',
    description: 'Unified data analytics platform with lakehouse architecture',
    icon: ' Databricks',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'workspace.read', description: 'Read workspace metadata', riskLevel: 'read', executable: false },
      { name: 'notebook.read', description: 'Read notebook content', riskLevel: 'read', executable: false },
      { name: 'cluster.read', description: 'Read cluster information', riskLevel: 'read', executable: false },
      { name: 'table.read', description: 'Read table metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token', 'oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'apache-spark',
    name: 'Apache Spark',
    vendor: 'Apache',
    category: 'data-platforms',
    description: 'Unified analytics engine for large-scale data processing',
    icon: ' Apache Spark',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'job.read', description: 'Read job metadata', riskLevel: 'read', executable: false },
      { name: 'query.execute', description: 'Execute Spark SQL queries', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'hadoop',
    name: 'Apache Hadoop',
    vendor: 'Apache',
    category: 'data-platforms',
    description: 'Framework for distributed storage and processing',
    icon: ' Hadoop',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'fs.read', description: 'Read filesystem metadata', riskLevel: 'read', executable: false },
      { name: 'job.read', description: 'Read job status', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['none', 'kerberos'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'delta-lake',
    name: 'Delta Lake',
    vendor: 'Databricks',
    category: 'data-platforms',
    description: 'Open-source storage layer for data lakes',
    icon: ' Delta Lake',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'table.read', description: 'Read table metadata', riskLevel: 'read', executable: false },
      { name: 'table.history', description: 'Read table history', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['password', 'certificate'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'apache-iceberg',
    name: 'Apache Iceberg',
    vendor: 'Apache',
    category: 'data-platforms',
    description: 'Open table format for large analytics datasets',
    icon: ' Iceberg',
    connectionType: 'connection',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'table.read', description: 'Read table metadata', riskLevel: 'read', executable: false },
      { name: 'snapshot.read', description: 'Read table snapshots', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['password', 'certificate'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];