// Design Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'figma',
    name: 'Figma',
    vendor: 'Figma',
    category: 'design',
    description: 'Collaborative interface design tool',
    icon: ' Figma',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'file.read', description: 'Read design file metadata', riskLevel: 'read', executable: false },
      { name: 'component.read', description: 'Read component data', riskLevel: 'read', executable: false },
      { name: 'comment.read', description: 'Read comments', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'adobe',
    name: 'Adobe',
    vendor: 'Adobe',
    category: 'design',
    description: 'Creative cloud applications and services',
    icon: ' Adobe',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'asset.read', description: 'Read asset metadata', riskLevel: 'read', executable: false },
      { name: 'library.read', description: 'Read library data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];