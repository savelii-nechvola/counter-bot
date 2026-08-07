type Env = {
  BOT_TOKEN: string;
  MEMBER_TAG: string;
};

function getEnv(): Env {
  const BOT_TOKEN = (process.env.BOT_TOKEN ?? "").trim();
  const MEMBER_TAG = (process.env.MEMBER_TAG ?? "").trim();

  const errors: { [K in keyof Env]?: string } = {};

  if (!BOT_TOKEN) {
    errors.BOT_TOKEN = "BOT_TOKEN is not provided";
  }

  if (!MEMBER_TAG) {
    errors.MEMBER_TAG = "MEMBER_TAG is not provided";
  }

  if (MEMBER_TAG.length > 8) {
    errors.MEMBER_TAG = "must be at most 8 characters long";
  }

  if (Object.keys(errors).length) {
    throw errors;
  }

  return {
    BOT_TOKEN: BOT_TOKEN,
    MEMBER_TAG: MEMBER_TAG,
  };
}

export const envVars = getEnv();
