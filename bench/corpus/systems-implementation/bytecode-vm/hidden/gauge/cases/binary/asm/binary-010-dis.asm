; case binary-010-dis
; expect exit=0 stdout="; svm disassembly\n.func main arity=0 locals=0 upvals=0\n  RET\n.end\n"
.func main arity=0 locals=0
  RET
.end
