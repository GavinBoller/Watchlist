{ pkgs }: {
  deps = [
    pkgs.nodejs-20_x
  ];
  env = {
    TMDB_API_KEY = "79d177894334dec45f251ff671833a50";
  };
}