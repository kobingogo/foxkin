"""Local preview with an optional same-origin proxy to the published encrypted sync API."""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit

parser=argparse.ArgumentParser()
parser.add_argument('--port',type=int,default=8765)
parser.add_argument('--api',default='')
args=parser.parse_args()
api=args.api.rstrip('/')
if api and (urlsplit(api).scheme!='https' or urlsplit(api).path not in ('','/')):
    parser.error('--api must be an HTTPS origin')

class Handler(SimpleHTTPRequestHandler):
    def proxy(self):
        if not api:
            self.send_error(503,'Configure --api to use cloud sync');return
        length=int(self.headers.get('Content-Length','0'))
        if length<0 or length>1050000:
            self.send_error(413);return
        headers={'Authorization':self.headers.get('Authorization',''),'Content-Type':'application/json','Origin':api}
        request=Request(api+self.path,data=self.rfile.read(length) if length else None,headers=headers,method=self.command)
        try:
            response=urlopen(request,timeout=20)
        except HTTPError as error:response=error
        except URLError:
            self.send_error(503,'Sync is temporarily unavailable');return
        with response:
            self.send_response(response.status)
            self.send_header('Content-Type',response.headers.get('Content-Type','application/json'))
            self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(response.read())
    def do_GET(self):
        if self.path.startswith('/api/'):self.proxy()
        else:super().do_GET()
    def do_PUT(self):
        if self.path.startswith('/api/'):self.proxy()
        else:self.send_error(405)
    def do_DELETE(self):
        if self.path.startswith('/api/'):self.proxy()
        else:self.send_error(405)
    def log_message(self,format,*values):
        if self.path.startswith('/api/'):return
        super().log_message(format,*values)

print(f'Foxkin local preview: http://127.0.0.1:{args.port}/',flush=True)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
