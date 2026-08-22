; case strops-054-chrord
; expect exit=0 stdout="65\n"
.func main arity=0 locals=0
  PUSH_INT 65
  CHR
  ORD
  PRINT
  RET
.end
