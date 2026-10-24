// Reads settings from .env into process.env, if the file exists. Import this
// before anything that reads process.env.
try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
