// Must come first: later modules generate ids as they load and run.
import './src/ui/polyfills';

import { registerRootComponent } from 'expo';

import './global.css';
import { App } from './src/ui/App';

registerRootComponent(App);
