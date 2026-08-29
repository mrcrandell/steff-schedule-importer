// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  nitro: {
    preset: "vercel",
  },

  runtimeConfig: {
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? "",
    public: {
      googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
    },
  },

  compatibilityDate: "2024-08-01",
});
