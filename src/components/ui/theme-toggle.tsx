// src/components/theme-toggle.ts
import { Moon, Sun } from "lucide-react"
import { useTheme } from "./theme-provider" // 👈 Ficou só "./"
import { Button } from "./button"           // 👈 Tirou o "ui/" porque já estão na mesma pasta

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      className="rounded-full w-10 h-10"
      title="Alternar Tema"
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Trocar tema</span>
    </Button>
  )
}
