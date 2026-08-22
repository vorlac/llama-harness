; case strops-051-chrord
; expect exit=0 stdout="9\n"
.func main arity=0 locals=0
  PUSH_INT 9
  CHR
  ORD
  PRINT
  RET
.end
