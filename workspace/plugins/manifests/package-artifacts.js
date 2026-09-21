// Package / Artifact Plugins - Part 2
// This file exports the second batch. Combine with part 1 for full catalog.

module.exports = [
  {
    id: 'github-packages',
    name: 'GitHub Packages',
    vendor: 'Microsoft',
    category: 'package',
    description: 'Package registry integrated with GitHub',
    icon: ' GitHub',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'package.read', description: 'Read package metadata', riskLevel: 'read', executable: false },
      { name: 'package.list', description: 'List packages', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'artifactory',
    name: 'Artifactory',
    vendor: 'JFrog',
    category: 'package',
    description: 'Universal artifact repository manager',
    icon: ' Artifactory',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'repository.read', description: 'Read repository metadata', riskLevel: 'read', executable: false },
      { name: 'artifact.read', description: 'Read artifact metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'nexus',
    name: 'Nexus',
    vendor: 'Sonatype',
    category: 'package',
    description: 'Repository manager for build artifacts',
    icon: ' Nexus',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'repository.read', description: 'Read repository metadata', riskLevel: 'read', executable: false },
      { name: 'artifact.read', description: 'Read artifact metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token', 'basic'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'docker-hub',
    name: 'Docker Hub',
    vendor: 'Docker',
    category: 'package',
    description: 'Container image registry',
    icon: ' Docker Hub',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'image.read', description: 'Read image metadata', riskLevel: 'read', executable: false },
      { name: 'image.search', description: 'Search images', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'amazon-ecr',
    name: 'Amazon ECR',
    vendor: 'Amazon',
    category: 'package',
    description: 'Container registry service on AWS',
    icon: ' ECR',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'repository.read', description: 'Read repository metadata', riskLevel: 'read', executable: false },
      { name: 'image.read', description: 'Read image metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['iam', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];