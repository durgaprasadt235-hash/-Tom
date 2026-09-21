// Edge / DNS Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'cloudflare-dns',
    name: 'Cloudflare',
    vendor: 'Cloudflare',
    category: 'edge',
    description: 'CDN, DNS, and security services',
    icon: ' Cloudflare',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'zone.read', description: 'Read zone metadata', riskLevel: 'read', executable: false },
      { name: 'dns.read', description: 'Read DNS records', riskLevel: 'read', executable: false },
      { name: 'dns.create', description: 'Create DNS records', riskLevel: 'write', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'aws-cloudfront',
    name: 'AWS CloudFront',
    vendor: 'Amazon',
    category: 'edge',
    description: 'Content delivery network service',
    icon: ' CloudFront',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'distribution.read', description: 'Read distribution metadata', riskLevel: 'read', executable: false },
      { name: 'distribution.create', description: 'Create distribution', riskLevel: 'write', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['iam', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'route-53',
    name: 'Route 53',
    vendor: 'Amazon',
    category: 'edge',
    description: 'DNS and domain name service',
    icon: ' Route 53',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'hosted_zone.read', description: 'Read hosted zone metadata', riskLevel: 'read', executable: false },
      { name: 'dns.read', description: 'Read DNS records', riskLevel: 'read', executable: false },
      { name: 'dns.create', description: 'Create DNS records', riskLevel: 'write', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['iam', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'azure-front-door',
    name: 'Azure Front Door',
    vendor: 'Microsoft',
    category: 'edge',
    description: 'Global HTTP load balancer and CDN',
    icon: ' Front Door',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'enterprise_license',
    capabilities: [
      { name: 'frontend.read', description: 'Read frontend metadata', riskLevel: 'read', executable: false },
      { name: 'route.read', description: 'Read route configuration', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];