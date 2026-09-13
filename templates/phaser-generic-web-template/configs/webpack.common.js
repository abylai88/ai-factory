const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const __base = path.resolve(__dirname, '..');
const __src = path.resolve(__base, 'src');

module.exports = {
  entry: {
    app: path.resolve(__src, 'index.ts')
  },

  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: '**/*',
          context: path.resolve(__base, 'public'),
          to: './'
        }
      ]
    }),
    new HtmlWebpackPlugin({
      title: 'Phaser Game',
      template: path.resolve(__src, 'html', 'index.html'),
      filename: 'index.html',
      minify: {
        removeComments: true,
        removeRedundantAttributes: true,
        useShortDoctype: true
      }
    }),
    new CleanWebpackPlugin({
      protectWebpackAssets: false,
      cleanAfterEveryBuildPatterns: ['*.LICENSE.txt'],
    }),
  ],

  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.(png|jpe?g|gif|svg)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/images/[name]-[hash:4][ext]'
        }
      },
      {
        test: /\.(woff(2)?|ttf|otf|eot|svg)(\?v=\d+\.\d+\.\d+)?$/,
        generator: {
          filename: 'assets/fonts/[name]-[hash:4].[ext]'
        }
      }
    ]
  },

  output: {
    filename: 'app.bundle.js',
    path: path.resolve(__base, 'build'),
    clean: true
  }
};
