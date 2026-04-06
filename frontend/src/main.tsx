import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { LanguageProvider } from './context/LanguageContext'
import Loader from './components/Loader'
import './i18n'
import './index.css'
import App from './App.tsx'

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<Loader variant="fullpage" />}>
      <GoogleOAuthProvider clientId={googleClientId}>
        <LanguageProvider>
          <App />
        </LanguageProvider>
      </GoogleOAuthProvider>
    </Suspense>
  </StrictMode>,
)
