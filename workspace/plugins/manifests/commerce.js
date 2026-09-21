// Commerce Plugins
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'stripe',
    name: 'Stripe',
    vendor: 'Stripe',
    category: 'commerce',
    description: 'Payment processing platform',
    icon: ' Stripe',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'payment.read', description: 'Read payment data', riskLevel: 'read', executable: false },
      { name: 'payment.create', description: 'Create payment', riskLevel: 'write', executable: false },
      { name: 'customer.read', description: 'Read customer data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'paypal',
    name: 'PayPal',
    vendor: 'PayPal',
    category: 'commerce',
    description: 'Digital payment platform',
    icon: ' PayPal',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'payment.read', description: 'Read payment data', riskLevel: 'read', executable: false },
      { name: 'payment.create', description: 'Create payment', riskLevel: 'write', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'api_key'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'shopify',
    name: 'Shopify',
    vendor: 'Shopify',
    category: 'commerce',
    description: 'E-commerce platform',
    icon: ' Shopify',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'product.read', description: 'Read product data', riskLevel: 'read', executable: false },
      { name: 'order.read', description: 'Read order data', riskLevel: 'read', executable: false },
      { name: 'customer.read', description: 'Read customer data', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];