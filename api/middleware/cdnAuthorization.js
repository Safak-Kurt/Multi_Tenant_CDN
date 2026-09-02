const {
  authenticateTenant
} = require("./auth");

const {
  authenticateSignedUrl
} = require("./signedUrlAuth");

function authorizeCdnRequest(
  req,
  res,
  next
) {
  const hasSignedUrlParams =
    req.query.signature !== undefined ||
    req.query.expires !== undefined;

  if (hasSignedUrlParams) {
    return authenticateSignedUrl(
      req,
      res,
      next
    );
  }

  return authenticateTenant(
    req,
    res,
    next
  );
}

module.exports = {
  authorizeCdnRequest
};
