; case strops-057-chrord
; expect exit=0 stdout="127\n"
.func main arity=0 locals=0
  PUSH_INT 127
  CHR
  ORD
  PRINT
  RET
.end
