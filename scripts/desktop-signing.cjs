const modes = new Set(['unsigned', 'signed']);

function requireEnv(env, names) {
  const missing = names.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Missing signing settings: ${missing.join(', ')}`);
}

function signingMode(env = process.env) {
  const mode = env.CONVLENS_SIGNING_MODE || 'unsigned';
  if (!modes.has(mode)) throw new Error('CONVLENS_SIGNING_MODE must be unsigned or signed');
  return mode;
}

function signingConfig(env = process.env, platform = process.platform) {
  const signed = signingMode(env) === 'signed';
  const config = {
    forceCodeSigning: signed,
    win: signed ? {} : { signExecutable: false },
    mac: signed ? {
      hardenedRuntime: true,
      notarize: true,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
    } : { identity: null, hardenedRuntime: false, notarize: false },
  };
  if (!signed) return config;
  if (platform === 'win32') {
    const provider = env.WINDOWS_SIGNING_PROVIDER || 'pfx';
    if (provider === 'pfx') {
      requireEnv(env, ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'WIN_CERT_SHA1']);
      if (!/^[a-f\d]{40}$/i.test(env.WIN_CERT_SHA1)) throw new Error('WIN_CERT_SHA1 must be a certificate thumbprint');
      config.win.signtoolOptions = {
        signingHashAlgorithms: ['sha256'],
        rfc3161TimeStampServer: 'http://timestamp.digicert.com',
      };
    } else if (provider === 'azure') {
      requireEnv(env, ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
        'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE', 'WIN_PUBLISHER_NAME']);
      config.win.azureSignOptions = {
        publisherName: env.WIN_PUBLISHER_NAME,
        endpoint: env.AZURE_SIGNING_ENDPOINT,
        codeSigningAccountName: env.AZURE_SIGNING_ACCOUNT,
        certificateProfileName: env.AZURE_SIGNING_PROFILE,
        fileDigest: 'SHA256',
        timestampDigest: 'SHA256',
        timestampRfc3161: 'http://timestamp.acs.microsoft.com',
      };
    } else {
      throw new Error('WINDOWS_SIGNING_PROVIDER must be pfx or azure');
    }
  } else if (platform === 'darwin') {
    requireEnv(env, ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER', 'APPLE_TEAM_ID']);
    if (!/^[A-Z\d]{10}$/.test(env.APPLE_TEAM_ID)) throw new Error('APPLE_TEAM_ID must be a 10-character Team ID');
    // The notarization helper gives Apple ID credentials precedence over API keys.
    if (env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD) throw new Error('Use only API key authentication for signed CI builds');
  } else {
    throw new Error('Signed desktop builds require a Windows or macOS host');
  }
  return config;
}

module.exports = { requireEnv, signingMode, signingConfig };
