// Package / Artifact Plugins - Part 1
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'npm',
    name: 'npm',
    vendor: 'GitHub',
    category: 'package',
    description: 'JavaScript package manager and registry',
    icon: ' npm',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'package.read', description: 'Read package metadata', riskLevel: 'read', executable: false },
      { name: 'package.search', description: 'Search packages', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'pypi',
    name: 'PyPI',
    vendor: 'Python',
    category: 'package',
    description: 'Python package index',
    icon: ' PyPI',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'package.read', description: 'Read package metadata', riskLevel: 'read', executable: false },
      { name: 'package.search', description: 'Search packages', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['none', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'maven',
    name: 'Maven',
    vendor: 'Apache',
    category: 'package',
    description: 'Java dependency management and build tool',
    icon: ' Maven',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'artifact.read', description: 'Read artifact metadata', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['none'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'nuget',
    name: 'NuGet',
    vendor: 'Microsoft',
    category: 'package',
    description: '.NET package manager',
    icon: ' NuGet',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'included',
    capabilities: [
      { name: 'package.read', description: 'Read package metadata', riskLevel: 'read', executable: false },
      { name: 'package.search', description: 'Search packages', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read'],
    supportedAuth: ['none', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];