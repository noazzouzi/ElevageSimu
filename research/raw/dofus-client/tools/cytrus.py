import flatbuffers, sys, json
from flatbuffers.table import Table
from flatbuffers import number_types as N
buf=open(sys.argv[1],'rb').read()
def root(buf):
    n=flatbuffers.encode.Get(N.UOffsetTFlags.packer_type, buf, 0)
    return Table(buf, n)
def field_off(t, slot):
    return t.Offset(4+2*slot)
def get_str(t,slot):
    o=field_off(t,slot)
    return t.String(o+t.Pos).decode('utf-8','replace') if o else None
def get_long(t,slot):
    o=field_off(t,slot)
    return t.Get(N.Int64Flags, o+t.Pos) if o else 0
def get_bytes(t,slot):
    o=field_off(t,slot)
    if not o: return b''
    start=t.Vector(o); ln=t.VectorLen(o)
    return bytes(t.Bytes[start:start+ln])
def get_tables(t,slot):
    o=field_off(t,slot)
    if not o: return []
    start=t.Vector(o); ln=t.VectorLen(o); res=[]
    for i in range(ln):
        x=start+i*4
        x=t.Indirect(x)
        res.append(Table(t.Bytes,x))
    return res
m=root(buf)
out={'files':{}, 'chunks':{}}
for frag in get_tables(m,0):
    fname=get_str(frag,0)
    for f in get_tables(frag,1):
        name=get_str(f,0); size=get_long(f,1); h=get_bytes(f,2).hex()
        chunks=[(get_bytes(c,0).hex(), get_long(c,1), get_long(c,2)) for c in get_tables(f,3)]
        out['files'][name]={'frag':fname,'size':size,'hash':h,'chunks':chunks}
    for b in get_tables(frag,2):
        bh=get_bytes(b,0).hex()
        for c in get_tables(b,1):
            out['chunks'][get_bytes(c,0).hex()]=(bh, get_long(c,1), get_long(c,2))
json.dump(out,open(sys.argv[2],'w'))
print(len(out['files']), len(out['chunks']))
