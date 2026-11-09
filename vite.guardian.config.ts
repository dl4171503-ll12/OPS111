import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {guardianPlugin} from './vite-plugins/guardian-plugin';
const root=__dirname;
export default defineConfig({cacheDir:'node_modules/.vite-guardian',root:path.join(root,'guardian'),envDir:root,plugins:[guardianPlugin(root),react()],resolve:{alias:{'@':path.join(root,'src')}},server:{host:'127.0.0.1',port:919,strictPort:true,watch:{ignored:['**/.ops-data/**','**/.ops-browser/**']},fs:{allow:[root],deny:['.env','.env.*','**/.git/**','**/.ops-data/**','**/.ops-browser/**','**/*.{crt,pem}']}},build:{outDir:path.join(root,'dist-guardian'),emptyOutDir:true},preview:{host:'127.0.0.1',port:919,strictPort:true}});
