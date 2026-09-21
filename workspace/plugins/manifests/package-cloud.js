// Package / Artifact Plugins - Part 3
// This file exports the third batch. Combine with parts 1-2 for full catalog.

module.exports = [
  {
    id: 'azure-container-registry',
    name: 'Azure Container Registry',
    vendor: 'Microsoft',
    category: 'package',
    description: 'Container registry service on Azure',
    icon: ' ACR',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'repository.read', description: 'Read repository metadata', riskLevel: 'read', executable: false },
      { name: 'image.read', description: 'Read image metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'google-artifact-registry',
    name: 'Google Artifact Registry',
    vendor: 'Google',
    category: 'package',
    description: 'Artifact storage and management on Google Cloud',
    icon: ' GAR',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'repository.read', description: 'Read repository metadata', riskLevel: 'read', executable: false },
      { name: 'artifact.read', description: 'Read artifact metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'service_account'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];