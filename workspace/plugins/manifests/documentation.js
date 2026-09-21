// Documentation / Storage Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'confluence',
    name: 'Confluence',
    vendor: 'Atlassian',
    category: 'documentation',
    description: 'Team collaboration and documentation platform',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'page.read', description: 'Read page content', riskLevel: 'read', executable: false },
      { name: 'page.create', description: 'Create new page', riskLevel: 'write', executable: false },
      { name: 'space.read', description: 'Read space metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'notion',
    name: 'Notion',
    vendor: 'Notion Labs',
    category: 'documentation',
    description: 'All-in-one workspace for notes, docs, and projects',
    icon: '﹒',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'page.read', description: 'Read page content', riskLevel: 'read', executable: false },
      { name: 'database.read', description: 'Read database contents', riskLevel: 'read', executable: false },
      { name: 'block.read', description: 'Read block content', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'sharepoint',
    name: 'SharePoint',
    vendor: 'Microsoft',
    category: 'documentation',
    description: 'Enterprise document management and collaboration',
    icon: '📄',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'document.read', description: 'Read document metadata', riskLevel: 'read', executable: false },
      { name: 'document.download', description: 'Download document', riskLevel: 'read', executable: false },
      { name: 'site.read', description: 'Read site metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    vendor: 'Google',
    category: 'documentation',
    description: 'Cloud storage and file synchronization',
    icon: '',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'file.read', description: 'Read file metadata', riskLevel: 'read', executable: false },
      { name: 'file.download', description: 'Download file', riskLevel: 'read', executable: false },
      { name: 'folder.read', description: 'Read folder structure', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    vendor: 'Microsoft',
    category: 'documentation',
    description: 'Cloud storage integrated with Microsoft 365',
    icon: '☁',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'file.read', description: 'Read file metadata', riskLevel: 'read', executable: false },
      { name: 'file.download', description: 'Download file', riskLevel: 'read', executable: false },
      { name: 'folder.read', description: 'Read folder structure', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    vendor: 'Dropbox',
    category: 'documentation',
    description: 'Cloud storage and file synchronization',
    icon: '💾',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'file.read', description: 'Read file metadata', riskLevel: 'read', executable: false },
      { name: 'file.download', description: 'Download file', riskLevel: 'read', executable: false },
      { name: 'folder.read', description: 'Read folder structure', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'box',
    name: 'Box',
    vendor: 'Box',
    category: 'documentation',
    description: 'Enterprise content management and file sharing',
    icon: '📦',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'file.read', description: 'Read file metadata', riskLevel: 'read', executable: false },
      { name: 'file.download', description: 'Download file', riskLevel: 'read', executable: false },
      { name: 'folder.read', description: 'Read folder structure', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];