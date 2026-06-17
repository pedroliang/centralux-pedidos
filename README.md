# CentraLux Pedidos

Sistema de controle de pedidos com auto-complete via Google Sheets, captura de fotos/assinaturas com webcam, e armazenamento no Cloudinary.

## Funcionalidades

- **Cadastro de Pedidos**: Código, cliente, vendedor, prioridade, data, entrega
- **Auto-Complete**: Código do pedido auto-completa cliente via Google Sheets
- **Vendedores**: Lista pré-cadastrada com opção de adicionar novos
- **Auto-Aprendizado**: Sistema memoriza vendedor-cliente para sugestão automática
- **Captura de Fotos**: Webcam ou upload de arquivo com compressão otimizada
- **Relatório**: Tabela com filtros, busca, indicadores de fotos
- **100% Estático**: Funciona no GitHub Pages sem backend

## Configuração do Cloudinary

Para que o upload de fotos funcione, crie um **upload preset não assinado** no Cloudinary:

1. Acesse [Cloudinary Dashboard](https://console.cloudinary.com/)
2. Vá em **Settings > Upload > Upload presets**
3. Clique em **Add upload preset**
4. Configure:
   - **Upload preset name**: `centralux_pedidos`
   - **Signing Mode**: `Unsigned`
   - **Folder**: `centralux_pedidos` (opcional)
5. Salve

## Tecnologias

- HTML5, CSS3, JavaScript (Vanilla)
- Google Sheets API (CSV público)
- Cloudinary (upload unsigned)
- localStorage
- GitHub Pages

## Desenvolvimento Local

```bash
# Servir localmente
npx -y serve . -l 3000
```
