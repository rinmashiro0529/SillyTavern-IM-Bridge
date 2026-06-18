const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = (_env, argv) => {
  const mode = argv && argv.mode ? argv.mode : "production";
  return {
    target: "node20",
    entry: "./src/plugin/index.ts",
    mode: mode,
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "index.js",
      library: { type: "commonjs2" },
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".js"],
      alias: {
        "abort-controller$": path.resolve(__dirname, "src/plugin/abort-controller-shim.js"),
      },
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
      ],
    },
    externalsPresets: { node: true },
    externals: {
      express: "commonjs2 express",
    },
    optimization: {
      minimize: mode === "production",
      minimizer: [
        new TerserPlugin({
          extractComments: false,
          terserOptions: {
            keep_classnames: true,
            keep_fnames: true,
            format: { comments: false },
          },
        }),
      ],
    },
    performance: { hints: false },
    devtool: mode === "production" ? "source-map" : "inline-source-map",
  };
};
