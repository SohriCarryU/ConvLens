import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { trainingFilesPlugin } from './scripts/training-files.mjs'

export default defineConfig({ plugins: [react(), trainingFilesPlugin()] })
