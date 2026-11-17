import type { ReactNode } from 'react'
import heroMp4 from '@/assets/brand/auth-hero.mp4'
import heroWebm from '@/assets/brand/auth-hero.webm'
import heroPoster from '@/assets/brand/auth-hero.webp'
import { ClayLoop, ZoraMark, ZoraWordmark } from '@/components/brand'
import { cn } from '@/lib/utils'

/**
 * The page around sign-in, sign-up, consent, invitations and the first
 * workspace: the logo in the top-left corner, a rounded card with the
 * claymation scene (a looping clip; its poster under reduced motion), and the
 * form. Below `lg` the logo is the Z with "zora" beside it; from `lg` the
 * corner keeps only the Z and "zora" sits large above the form. The scene
 * card is a short banner just above the form below `lg` (the two centred
 * together, as wide as the form card), framed on the Z and the cat; from `lg`
 * it fills the right column. Grid areas move the one card, so the clip is
 * never loaded twice.
 */
export function AuthLayout({
  children,
  tagline,
}: {
  children: ReactNode
  /** A line above the form (the slogan on sign-in and sign-up). */
  tagline?: string
}) {
  return (
    <main className="grid min-h-svh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto_auto_1fr] [grid-template-areas:'logo'_'.'_'art'_'form'_'.'] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'logo_art'_'form_art']">
      <div className="px-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-[1.625rem] [grid-area:logo] sm:px-10 lg:text-[2rem]">
        <span className="zora-logo inline-flex items-center gap-[0.22em]">
          <ZoraMark />
          <ZoraWordmark className="lg:hidden" />
        </span>
      </div>
      <aside aria-hidden="true" className="min-w-0 px-6 pt-6 [grid-area:art] sm:px-10 lg:p-3">
        <div className="relative mx-auto aspect-[4/3] max-h-[34svh] max-w-sm overflow-hidden rounded-[1.75rem] bg-[#a8d8e8] lg:sticky lg:top-3 lg:aspect-auto lg:h-[calc(100svh-1.5rem)] lg:max-h-none lg:max-w-none lg:rounded-[2rem]">
          <ClayLoop
            webm={heroWebm}
            mp4={heroMp4}
            poster={heroPoster}
            className="absolute inset-0 size-full object-[50%_58%]"
          />
        </div>
      </aside>
      <div className="animate-in fade-in slide-in-from-bottom-3 flex min-w-0 flex-col items-center justify-center px-6 pt-6 pb-10 duration-500 ease-out [grid-area:form] motion-reduce:animate-none sm:px-10">
        <div className={cn('flex flex-col items-center text-center lg:mb-8', tagline && 'mb-6')}>
          <p className="hidden text-[3.5rem] lg:block">
            <ZoraWordmark />
          </p>
          {tagline ? (
            <p className="text-muted-foreground max-w-[26ch] text-lg text-balance lg:mt-3 lg:text-xl">
              {tagline}
            </p>
          ) : null}
        </div>
        {children}
      </div>
    </main>
  )
}
