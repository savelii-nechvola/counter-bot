type Env = {
  BOT_TOKEN: string;
};

function getEnv(): Env {
  const BOT_TOKEN = (process.env.BOT_TOKEN ?? "").trim();

  const errors: { [K in keyof Env]?: string } = {};

  if (!BOT_TOKEN) {
    errors.BOT_TOKEN = "BOT_TOKEN is not provided";
  }

  if (Object.keys(errors).length) {
    throw errors;
  }

  return {
    BOT_TOKEN: BOT_TOKEN,
  };
}

export const envVars = getEnv();
