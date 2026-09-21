// Infrastructure as Code Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'terraform',
    name: 'Terraform',
    vendor: 'HashiCorp',
    category: 'infrastructure',
    description: 'Infrastructure as Code for multi-cloud provisioning',
    icon: '',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'state.read', description: 'Read infrastructure state', riskLevel: 'read', executable: false },
      { name: 'plan.read', description: 'Read execution plan', riskLevel: 'read', executable: false },
      { name: 'resource.read', description: 'Read resource metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'pulumi',
    name: 'Pulumi',
    vendor: 'Pulumi',
    category: 'infrastructure',
    description: 'Infrastructure as Code using general-purpose languages',
    icon: '',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'state.read', description: 'Read infrastructure state', riskLevel: 'read', executable: false },
      { name: 'stack.read', description: 'Read stack metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'cloudformation',
    name: 'CloudFormation',
    vendor: 'Amazon',
    category: 'infrastructure',
    description: 'AWS infrastructure as code service',
    icon: ' AWS',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'stack.read', description: 'Read stack metadata', riskLevel: 'read', executable: false },
      { name: 'template.read', description: 'Read template content', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['iam', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'azure-bicep',
    name: 'Azure Bicep',
    vendor: 'Microsoft',
    category: 'infrastructure',
    description: 'Declarative Azure infrastructure as code',
    icon: '',
    connectionType: 'cli',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'deployment.read', description: 'Read deployment metadata', riskLevel: 'read', executable: false },
      { name: 'resource.read', description: 'Read resource metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute', 'destructive'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];