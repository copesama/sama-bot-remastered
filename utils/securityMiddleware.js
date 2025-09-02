/**
 * Security middleware for Express application
 */

/**
 * Adds security headers to all responses
 */
function securityHeaders(req, res, next) {
  // Add security headers to prevent XSS, clickjacking, etc.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  
  // Set Content-Security-Policy for game routes specifically
  if (req.path.startsWith('/game/')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdn.discordapp.com https://ui-avatars.com https://i.imgur.com https://media.discordapp.net data:; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; frame-src 'none'; media-src 'self' data:;"
    );
  }
  
  next();
}

/**
 * Sanitizes cookie values to prevent XSS
 */
function sanitizeCookies(req, res, next) {
  // If gameUserData cookie exists, try to sanitize it
  if (req.cookies && req.cookies.gameUserData) {
    try {
      const userData = JSON.parse(req.cookies.gameUserData);
      
      // Sanitize username
      if (userData.username) {
        userData.username = userData.username
          .replace(/[^\w\s\-_.@]/g, '')
          .substring(0, 32);
      }
      
      // Validate avatar URL
      if (userData.avatar) {
        const trustedDomains = [
          'cdn.discordapp.com',
          'i.imgur.com', 
          'ui-avatars.com',
          'media.discordapp.net'
        ];
        
        const isValidAvatar = trustedDomains.some(domain => 
          userData.avatar.startsWith(`https://${domain}/`)
        );
        
        if (!isValidAvatar) {
          userData.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.username?.[0] || 'U')}&background=random&size=128`;
        }
      }
      
      // Update the cookie with sanitized data
      res.cookie('gameUserData', JSON.stringify(userData), { 
        maxAge: 3600000, 
        httpOnly: false,
        sameSite: 'Lax',
        secure: process.env.NODE_ENV === 'production'
      });
    } catch (err) {
      // Clear the cookie if it can't be sanitized
      res.clearCookie('gameUserData');
    }
  }
  
  next();
}

module.exports = {
  securityHeaders,
  sanitizeCookies
};