const path = require('path/posix');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

const __base = path.resolve(__dirname, '..');
const __src = path.resolve(__base, 'src');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',

  resolve: {
    plugins: [
      new TsconfigPathsPlugin({
        baseUrl: __base,
        configFile: path.join(__base, 'tsconfig.json')
      })
    ],
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
  },

  devServer: {
    port: 9100,
    static: './build',
    hot: true,
    client: {
      overlay: true
    }
  },

  module: {
    rules: [
      {
        test: /\.(css|scss|sass)$/i,
        use: [
          "style-loader",
          "css-loader",
        ],
      }
    ]
  },
});
