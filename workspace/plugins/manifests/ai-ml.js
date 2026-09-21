// AI / ML Plugins - Part 1
// Catalog metadata only - no executable handlers

module.exports = [
  {
    id: 'openai',
    name: 'OpenAI',
    vendor: 'OpenAI',
    category: 'ai-ml',
    description: 'AI models and API for language, vision, and more',
    icon: ' OpenAI',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'chat.complete', description: 'Complete chat messages', riskLevel: 'read', executable: false },
      { name: 'embedding.generate', description: 'Generate text embeddings', riskLevel: 'read', executable: false },
      { name: 'image.generate', description: 'Generate images', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    vendor: 'Anthropic',
    category: 'ai-ml',
    description: 'AI assistant and model API',
    icon: ' Anthropic',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'chat.complete', description: 'Complete chat messages', riskLevel: 'read', executable: false },
      { name: 'embedding.generate', description: 'Generate text embeddings', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    vendor: 'Google',
    category: 'ai-ml',
    description: 'Multimodal AI model family',
    icon: ' Gemini',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'chat.complete', description: 'Complete chat messages', riskLevel: 'read', executable: false },
      { name: 'embedding.generate', description: 'Generate text embeddings', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['oauth', 'service_account'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  },
  {
    id: 'nvidia',
    name: 'NVIDIA',
    vendor: 'NVIDIA',
    category: 'ai-ml',
    description: 'AI computing platform and model services',
    icon: ' NVIDIA',
    connectionType: 'api',
    availability: 'available',
    billingMode: 'vendor_billed',
    capabilities: [
      { name: 'model.inference', description: 'Run model inference', riskLevel: 'read', executable: false },
      { name: 'embedding.generate', description: 'Generate embeddings', riskLevel: 'read', executable: false }
    ],
    riskLevels: ['read', 'write'],
    supportedAuth: ['token'],
    installable: true,
    installed: false,
    enabled: false,
    status: 'available'
  }
];