// Cloud Platform Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'aws',
    name: 'AWS',
    vendor: 'Amazon',
    category: 'cloud',
    description: 'Comprehensive cloud computing platform with 200+ services',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'resource.read', description: 'Read resource metadata', riskLevel: 'read', executable: false },
      { name: 'resource.list', description: 'List resources', riskLevel: 'read', executable: false },
      { name: 'metrics.read', description: 'Read CloudWatch metrics', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'privileged', 'destructive'],
    supportedAuth: ['iam', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'azure',
    name: 'Microsoft Azure',
    vendor: 'Microsoft',
    category: 'cloud',
    description: 'Enterprise cloud platform with integrated services',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'resource.read', description: 'Read resource metadata', riskLevel: 'read', executable: false },
      { name: 'resource.list', description: 'List resources', riskLevel: 'read', executable: false },
      { name: 'metrics.read', description: 'Read Azure Monitor metrics', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'privileged', 'destructive'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'google-cloud',
    name: 'Google Cloud',
    vendor: 'Google',
    category: 'cloud',
    description: 'Cloud platform with data analytics and AI services',
    icon: ' GCP',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'resource.read', description: 'Read resource metadata', riskLevel: 'read', executable: false },
      { name: 'resource.list', description: 'List resources', riskLevel: 'read', executable: false },
      { name: 'metrics.read', description: 'Read Cloud Monitoring metrics', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'privileged', 'destructive'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'oracle-cloud',
    name: 'Oracle Cloud',
    vendor: 'Oracle',
    category: 'cloud',
    description: 'Enterprise cloud with IaaS and PaaS offerings',
    icon: '☁',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'resource.read', description: 'Read resource metadata', riskLevel: 'read', executable: false },
      { name: 'resource.list', description: 'List resources', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'privileged', 'destructive'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];