// Strips fields that should never reach the browser (password hash, Stripe
// account ids) down to what's safe to expose about a user.
function publicUser(user) {
  if (!user) return null;
  const {
    id,
    role,
    name,
    username,
    bio,
    membershipTier,
    membershipStatus,
    adStatus,
    onboardingComplete,
    coachSurveyComplete,
    clientCountBand,
    coachingType,
    hasUsedTrial,
  } = user;
  return {
    id,
    role,
    name,
    username,
    bio,
    membershipTier,
    membershipStatus,
    adStatus,
    onboardingComplete,
    coachSurveyComplete,
    clientCountBand,
    coachingType,
    hasUsedTrial,
  };
}

module.exports = { publicUser };
