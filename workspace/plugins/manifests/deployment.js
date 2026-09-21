// Deployment / Hosting Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'vercel',
    name: 'Vercel',
    vendor: 'Vercel',
    category: 'deployment',
    description: 'Frontend cloud platform for hosting and serverless functions',
    icon: ' Vercel',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'project.read', description: 'Read project metadata', riskLevel: 'read', executable: false },
      { name: 'deployment.read', description: 'Read deployment status', riskLevel: 'read', executable: false },
      { name: 'domain.read', description: 'Read domain configuration', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'netlify',
    name: 'Netlify',
    vendor: 'Netlify',
    category: 'deployment',
    description: 'Web hosting and serverless backend platform',
    icon: '🌐',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'site.read', description: 'Read site metadata', riskLevel: 'read', executable: false },
      { name: 'deployment.read', description: 'Read deployment status', riskLevel: 'read', executable: false },
      { name: 'form.read', description: 'Read form submissions', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['oauth', 'token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    vendor: 'Cloudflare',
    category: 'deployment',
    description: 'CDN, DNS, and security services',
    icon: '☁',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'zone.read', description: 'Read zone metadata', riskLevel: 'read', executable: false },
      { name: 'dns.read', description: 'Read DNS records', riskLevel: 'read', executable: false },
      { name: 'analytics.read', description: 'Read analytics data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'render',
    name: 'Render',
    vendor: 'Render',
    category: 'deployment',
    description: 'Cloud hosting for web services and static sites',
    icon: ' Render',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'service.read', description: 'Read service metadata', riskLevel: 'read', executable: false },
      { name: 'service.log', description: 'Read service logs', riskLevel: 'read', executable: false },
      { name: 'deployment.read', description: 'Read deployment status', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'railway',
    name: 'Railway',
    vendor: 'Railway',
    category: 'deployment',
    description: 'Cloud platform for deploying applications',
    icon: '🚂',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'project.read', description: 'Read project metadata', riskLevel: 'read', executable: false },
      { name: 'service.read', description: 'Read service metadata', riskLevel: 'read', executable: false },
      { name: 'deployment.read', description: 'Read deployment status', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'heroku',
    name: 'Heroku',
    vendor: 'Salesforce',
    category: 'deployment',
    description: 'Cloud platform for building and running applications',
    icon: '🟣',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'app.read', description: 'Read app metadata', riskLevel: 'read', executable: false },
      { name: 'app.log', description: 'Read app logs', riskLevel: 'read', executable: false },
      { name: 'release.read', description: 'Read release history', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write', 'execute'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];