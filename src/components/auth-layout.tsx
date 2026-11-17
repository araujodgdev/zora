import type { ReactNode } from 'react'
import heroMp4 from '@/assets/brand/auth-hero.mp4'
import heroWebm from '@/assets/brand/auth-hero.webm'
import heroPoster from '@/assets/brand/auth-hero.webp'
import { ClayLoop, ZoraLogo } from '@/components/brand'

/**
 * The page around sign-in, sign-up, consent, invitations and the first
 * workspace: the logo, a rounded card with the claymation scene (a looping
 * clip; its poster under reduced motion) and the form. Below `lg` the card is
 * a short banner just above the form (the two centred together below the
 * logo, as wide as the form card), framed on the Z and the cat; from `lg` it fills the right column, with the headline over its sky. Grid
 * areas move the one card, so the clip is never loaded twice. The scene is the
 * same in both themes, so the text on it uses fixed ink.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-svh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto_auto_1fr] [grid-template-areas:'logo'_'.'_'art'_'form'_'.'] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'logo_art'_'form_art']">
      <p className="px-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-[1.625rem] [grid-area:logo] sm:px-10">
        <ZoraLogo aria-label="Zora" />
      </p>
      <aside aria-hidden="true" className="min-w-0 px-6 pt-6 [grid-area:art] sm:px-10 lg:p-3">
        <div className="relative mx-auto aspect-[4/3] max-h-[34svh] max-w-sm overflow-hidden rounded-[1.75rem] bg-[#a8d8e8] lg:sticky lg:top-3 lg:aspect-auto lg:h-[calc(100svh-1.5rem)] lg:max-h-none lg:max-w-none lg:rounded-[2rem]">
          <ClayLoop
            webm={heroWebm}
            mp4={heroMp4}
            poster={heroPoster}
            className="absolute inset-0 size-full object-[50%_58%] lg:object-[50%_0%]"
          />
          <div className="relative hidden px-10 pt-12 text-center text-neutral-950 lg:block xl:pt-16">
            <p className="mx-auto max-w-[14ch] text-[clamp(2rem,3.2vw,3.25rem)] leading-[1.02] font-extrabold tracking-[-0.045em] text-balance">
              Do rascunho ao post publicado.
            </p>
            <p className="mt-3 hidden text-lg font-medium text-neutral-950/70 xl:block">
              Calendário, pipeline e textos do lançamento.
            </p>
          </div>
        </div>
      </aside>
      <div className="animate-in fade-in slide-in-from-bottom-3 flex min-w-0 flex-col items-center justify-center px-6 pt-6 pb-10 duration-500 ease-out [grid-area:form] motion-reduce:animate-none sm:px-10">
        {children}
      </div>
    </main>
  )
}
