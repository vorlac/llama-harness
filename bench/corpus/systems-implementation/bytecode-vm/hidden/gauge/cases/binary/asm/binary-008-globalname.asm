; case binary-008-globalname
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_INT 1
  STORE_GLOBAL g
  LOAD_GLOBAL g
  PRINT
  RET
.end
