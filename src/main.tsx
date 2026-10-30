import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/manrope'
import App from './App'
import { RallyProvider } from './store'
import './styles.css'
import './themes.css'
import { ThemeProvider } from './lib/theme'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <RallyProvider>
        <App />
      </RallyProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
