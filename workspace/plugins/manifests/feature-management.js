// Feature Management Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'launchdarkly',
    name: 'LaunchDarkly',
    vendor: 'LaunchDarkly',
    category: 'feature-management',
    description: 'Feature flag and-toggle management platform',
    icon: ' LaunchDarkly',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'flag.read', description: 'Read feature flag data', riskLevel: 'read', executable: false },
      { name: 'flag.update', description: 'Update feature flag', riskLevel: 'write', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];