module.exports = {
  apps: [
    {
      name: "buildesk-people",
      script: "npm",
      args: "start",
      interpreter: "none",
      env: {
        PORT: "3010",
        HOST: "127.0.0.1",
        NODE_ENV: "production",
      },
    },
  ],
};
