; case strops-064-ordempty
; expect exit=4 stdout=""
; expect error=E_RANGE
.func main arity=0 locals=0
  PUSH_STR ""
  ORD
  PRINT
  RET
.end
