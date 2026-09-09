'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut, ChevronRight, Smartphone, User, ShieldCheck, ShieldAlert, Headset } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useUser } from '@/lib/hooks/useUser'
import { createClient } from '@/lib/supabase/client'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import Link from 'next/link'

export default function SettingsPage() {
  const { profile, loading } = useUser()
  const router = useRouter()
  const supabase = createClient()

  // PWA install - lives here (not the landing page) so it only shows up once
  // Someone already has an account and has spent a bit of time in the app,
  // Which is also when the browser is actually willing to fire the native prompt.
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  const [installed, setInstalled] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true)
    }
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream)

    const handler = (e: any) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => {
      setInstalled(true)
      setInstalling(false)
    })
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (installed) return

    if (installPrompt) {
      setInstalling(true)
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      if (outcome !== 'accepted') setInstalling(false)
      setInstallPrompt(null)
      return
    }

    if (isIOS) {
      alert('To install SociaLens on iPhone:\n\n1. Open this page in Safari\n2. Tap the Share button (bottom center)\n3. Tap "Add to Home Screen"\n4. Tap "Add"')
      return
    }

    alert("Your browser doesn't support installing SociaLens yet. Try opening this page in Chrome or Edge.")
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) return <PageLoader />
  if (!profile) return null

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-bold">Settings</h1>

      {/* Account */}
      <Card>
        <CardContent className="pt-4 divide-y">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide pb-2">Account</p>
          <Link href="/settings/general" className="flex items-center justify-between py-3 hover:text-pink-500 transition-colors">
            <div className="flex items-center gap-3">
              <User className="h-5 w-5" />
              <div>
                <span className="text-sm font-medium block">General Settings</span>
                <span className="text-xs text-muted-foreground">Edit profile, accounts, saved posts</span>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      {/* Privacy */}
      <Card>
        <CardContent className="pt-4 divide-y">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide pb-2">Privacy</p>
          <Link href="/settings/privacy" className="flex items-center justify-between py-3 hover:text-pink-500 transition-colors">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5" />
              <div>
                <span className="text-sm font-medium block">Privacy Settings</span>
                <span className="text-xs text-muted-foreground">Account privacy, policy & terms</span>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      {/* Support */}
      <Card>
        <CardContent className="pt-4 divide-y">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide pb-2">Support</p>
          <Link href="/settings/support" className="flex items-center justify-between py-3 hover:text-pink-500 transition-colors">
            <div className="flex items-center gap-3">
              <Headset className="h-5 w-5" />
              <div>
                <span className="text-sm font-medium block">Support</span>
                <span className="text-xs text-muted-foreground">Contact us, privacy policy & terms</span>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>

      {/* Admin - only ever visible to the one account with is_admin = true */}
      {profile.is_admin && (
        <Card className="border-pink-500/30">
          <CardContent className="pt-4 divide-y">
            <p className="text-xs text-pink-500 font-semibold uppercase tracking-wide pb-2">Admin</p>
            <Link href="/settings/admin" className="flex items-center justify-between py-3 hover:text-pink-500 transition-colors">
              <div className="flex items-center gap-3">
                <ShieldAlert className="h-5 w-5 text-pink-500" />
                <div>
                  <span className="text-sm font-medium block">Admin Panel</span>
                  <span className="text-xs text-muted-foreground">Reports, suspensions & restrictions</span>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      )}

      {/* App - only show if not already installed */}
      {!installed && (
        <Card>
          <CardContent className="pt-4 divide-y">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide pb-2">App</p>
            <button
              onClick={handleInstall}
              disabled={installing}
              className="w-full flex items-center justify-between py-3 text-left hover:text-pink-500 transition-colors disabled:hover:text-inherit disabled:cursor-default"
            >
              <div className="flex items-center gap-3">
                <Smartphone className="h-5 w-5" />
                <div>
                  <p className="text-sm font-medium">
                    {installing ? 'Installing...' : 'Install SociaLens'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Add SociaLens to your home screen for quick access
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </CardContent>
        </Card>
      )}

      {/* Logout */}
      <Button variant="destructive" className="w-full gap-2" onClick={handleLogout}>
        <LogOut className="h-4 w-4" />
        Log Out
      </Button>

      <p className="text-center text-xs text-muted-foreground pb-4">SociaLens v1.0.0</p>
    </div>
  )
}
