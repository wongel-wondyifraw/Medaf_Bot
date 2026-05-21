module.exports = {
  apps: [
    {
      name: 'shein-bot',
      script: 'dist/main.js',
      watch: false,
      restart_delay: 3000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
