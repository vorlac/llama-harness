; case strops-056-chrord
; expect exit=0 stdout="126\n"
.func main arity=0 locals=0
  PUSH_INT 126
  CHR
  ORD
  PRINT
  RET
.end
